# Ronda de pulido premium

Una ronda de calidad, no de funciones nuevas: el mismo producto, más claro, más coherente y más robusto. Este
documento recoge las reglas que deja la ronda (para que las pantallas nuevas las sigan) y cómo se vigilan.

## 1. Escala tipográfica (css/app.css `:root`)

| Token | Tamaño | Uso |
|---|---|---|
| `--fs-xs` | 12 px | etiquetas en mayúsculas, insignias pequeñas, sufijos de unidad (`kg`) |
| `--fs-sm` | 13 px | notas, subtítulos de fila, insignias |
| `--fs-md` | 15 px | texto secundario de tarjetas y filas |
| `--fs-body` | 17 px | cuerpo (el de iOS) |
| `--fs-title` | 20 px | títulos de bloque |
| `--fs-display` | 28 px | cifras protagonistas |

- **12 px es el mínimo** dentro de las pantallas. La única excepción es la etiqueta de la barra de pestañas
  (11 px, como en iOS).
- Nada de medios píxeles (12,5 / 13,5 / 14,5 px): se llevan al escalón más cercano.
- Cifra con unidad en una casilla (KPI): la cifra grande y la unidad pequeña (`.kpi-unit`), con el mismo texto.
- Nombres largos en listas (rutinas, carreras): hasta dos líneas (`.list-item-title.lines-2`) antes de recortar.

## 2. Objetivos táctiles

- 44 px de alto como mínimo para cualquier botón, enlace o campo, también los compactos (`.btn-sm`).
- Las zonas del mapa corporal son regiones de un dibujo (SVG) y se tocan por su área: no cuentan.

## 3. Nodos del DOM

`h()` (ui.js) se salta los hijos `null`/`false`, pero **`Element.append`, `prepend` y `replaceChildren` nativos
no**: escriben el texto «null». Con hijos condicionales se filtra antes:
`el.append(...[a, cond ? b : null, c].filter(Boolean))`.

## 4. Guardas visuales (tests/e2e/visual-guard.test.cjs)

Recorre todas las pantallas con datos realistas (tests/e2e/realistic-data.cjs: 6 meses de fuerza, carrera, bici,
peso, ciclo, objetivos, contexto, un evento y una sesión a medias; datos sintéticos, nada personal) a 375 y 430 px,
y la app vacía a 375 px, en Chromium y en WebKit. Comprueba invariantes que no dependen de píxeles:

- ningún texto roto («null», «undefined», NaN, Infinity, «[object …]», «:-5», ritmos «h:mm:ss /km»);
- sin scroll horizontal ni nada que se salga por un lado (salvo dentro de un carrusel);
- la cabecera no tapa el principio y lo último queda por encima de la barra de pestañas;
- ningún texto de menos de 12 px y ningún objetivo táctil de menos de 44 px;
- ningún error en la consola.

Deja una captura de cada pantalla en `test-results/visual/` para revisarlas a ojo (no se comparan píxel a píxel:
una comparación así se rompe con cualquier cambio de fuente o de antialiasing y acaba ignorándose).

## 5. Estados (ui.js `stateTag`)

Un solo componente para todos los estados, con icono y texto (nunca solo color):

| Estado | Clase | Icono | Ejemplos |
|---|---|---|---|
| Bien | `state-ok` | ✓ | «Bien», «En tu rango» |
| Atención | `state-warn` | ⚠ | «Atención», «Sin subir» |
| Info / Nota | `state-info` / `state-neutral` | ⓘ | «Info» (azul), «Nota» (gris) |
| Faltan datos | `state-insufficient` | reloj, borde discontinuo | «Faltan datos» |
| Progresa | `state-progress` | ↑ | «Progresa», «Subir peso» |
| Estancado | `state-stalled` | – | «Estancado» |
| Récord | `state-pr` | trofeo | «Récord» |
| Error | `state-error` | ✕ | |
| Confianza | `state-conf-high/medium/low/insufficient` | sin icono, contorno | «Confianza media» |

El panel semanal (`.wk-level`), el analista (`.an-level`, `.an-conf`) y Tiempos previstos (`.prd-conf`) usan este
componente (las clases antiguas se conservan como alias para las pruebas). «Info» es azul en todas partes; antes era
azul en el panel y gris en el analista.

## 6. «Lo importante esta semana» y el resumen del analista (js/focus.js)

Una sola lista corta para Hoy (antes había dos tarjetas: el resumen del panel semanal y «Tu análisis») y para el
resumen de #/analysis:

- Uno principal y hasta dos secundarios. Candidatos: los mensajes clave del panel semanal y los puntos clave del
  analista (no se calcula nada nuevo).
- Un mensaje por tema (`topicOf`): si el panel y el analista hablan de los ejercicios estancados, sale uno (el del
  analista, que lleva confianza y fuentes).
- Solo entra lo que pide un cambio (Atención, «Subir peso») o lo que va bien. Lo informativo no ocupa hueco.
- Sin avisos: «Todo evoluciona dentro de lo esperado. No necesitas cambiar nada.» No se fuerza un problema.
- Cada uno lleva **un** «Qué hacer». Si el analista ya da su recomendación (`parts.recommendation`), esa es la
  acción y no se repite en el texto; si no, una de esta lista: Mantén lo que haces · No necesitas cambiar nada ·
  Acumula más datos · Reevalúa en una semana · Prioriza la recuperación · Reduce 1–2 series · Añade 1–2 series ·
  Sube el peso.

## 7. «Cómo vas» (portada de Progreso, js/overview.js)

Cuatro filas —Fuerza, Resistencia, Cuerpo, Recuperación— con su cifra clave, el cambio reciente (4 últimas semanas
completas frente a las 4 anteriores; la semana en curso no cuenta), una minigráfica de 12 semanas
(`charts.sparkline`, sin ejes) y el acceso al detalle (#/analysis?area=…, #/bodyweight). Sin datos, cada fila dice
qué falta. Resistencia toma el deporte al que dedicas más tiempo (no más km: la bici siempre gana en km).

## 8. Orden de Hoy

- Sesión abierta: «Sesión en curso» manda (nombre, cronómetro, «2 de 20 series», «En lugar de Día 3 — Cardio» si
  sustituye a lo planificado) y «Te toca hoy» no la repite debajo.
- Antes de entrenar: «Te toca hoy» con «Empezar»; el check-in, «Lo importante esta semana» y los objetivos, al final.
- Hecho, saltado o descanso: no queda nada que empezar, así que «Lo importante esta semana» sube por encima de
  «Registrar».
- Evento a 14 días o menos: tarjeta debajo de «Te toca hoy» («10K · En 5 días»); más lejos, una línea.

## 9. Términos

| Término | Significa | No usar |
|---|---|---|
| Récord | La mejor marca de SIEMPRE (fuerza o resistencia), venga de una sesión, de una actividad importada o de una marca histórica | «PR» en la interfaz (solo el icono 🏆) |
| Marca histórica | Un resultado anterior a Entreno, apuntado a mano (Récords › Marcas históricas o un resultado de carrera en Tu contexto) | «marca antigua», «PR histórico» |
| Mejor serie | La serie concreta con más peso × reps de un ejercicio | |
| 1RM estimado | Repetición máxima calculada con Epley (reps + RIR). «1RM est.» solo en etiquetas cortas | «1RM» a secas cuando es estimado |
| Serie de trabajo | Cualquier serie hecha que no es calentamiento (tipos Efectiva, Al fallo, Drop) | |
| Series efectivas (por músculo) | Series de trabajo repartidas por músculo (principal 1, secundario según Ajustes) frente a tu rango semanal | usarlo para el total de series de una sesión |
| Efectiva | El tipo de serie normal en la sesión (frente a Calentamiento, Al fallo, Drop) | |
| Volumen | kg × reps de las series de trabajo | «carga» |
| Carga | Minutos × esfuerzo percibido (RPE) de TODAS las sesiones | «volumen» |
| Tendencia | Lo que dice la pendiente de tus datos (peso medio, 1RM estimado) | |
| Tiempo previsto | La estimación actual de una distancia (pantalla «Tiempos previstos») | «predicción» en títulos |
| Confianza | Alta / media / baja / datos insuficientes: cuánto fiarse de una estimación | |
| Tu contexto | Fases y hechos que explican tus datos (vacaciones, creatina, un resultado de carrera) | |
| Fase | Un periodo de tu contexto con principio (y fin) | |
| Evento | Algo FUTURO apuntado en Eventos (una carrera, una marcha) | para hechos pasados (eso es contexto) |
| Actividad | Carrera, bici, natación, senderismo u otra (no fuerza) | |
| Sesión | Un entrenamiento de fuerza (o cualquier registro, en el historial) | |

## 10. Sesión en curso (session-view-card.js) y resumen (session-view-summary.js)

- «Última vez · 5 oct» con las series más grandes (16 px, negrita), cada serie entera en su línea.
- Siguiente paso de la doble progresión **en la línea del objetivo** (no añade altura: en un iPhone SE «Registrar
  serie» sigue a la vista sin desplazar, lo vigila session.test «una mano en iPhone SE»):
  «Objetivo 3×4–6 · ↑ Sube a 82,5 kg» o «Objetivo 3×4–6 · ◎ 6/6/6 → +2,5 kg» (al completar 6/6/6, +2,5 kg). Es la
  MISMA regla e incrementos que el panel semanal (js/progression.js, que el panel reexporta) y lleva la frase entera
  para VoiceOver («Siguiente paso: +2,5 kg cuando completes 6/6/6»).
- Resumen: tres cifras protagonistas (duración, series de trabajo, récords) y una línea con esfuerzo, volumen y
  carga. «Frente a la anterior» (js/session-compare.js): la sesión terminada anterior de la MISMA rutina; por
  ejercicio, la serie más pesada («+2,5 kg», «+2 reps», «Igual», «−1 rep»), como mucho 5 filas (primero lo que
  mejora) y los totales (series, volumen, duración). Solo datos reales; sesión libre o sin anterior → no sale.

## 11. Navegación: «atrás» y enseguida otra pantalla

`router.back()` usa `history.back()`, que es asíncrono. Si mientras tanto se navegaba (tocar una pestaña justo
después de «atrás», o la propia app tras borrar algo), la vuelta llegaba después y deshacía esa navegación: se
acababa en otra pantalla. Ahora una navegación pedida con un «atrás» en camino espera a que llegue (popstate /
hashchange; red de seguridad de 4 s). Pruebas: transitions.test «“atrás” y enseguida otra pantalla».

## 12. Gráficas: la frase de arriba

Cada gráfica principal dice en una frase qué hay que entender del periodo elegido (js/chart-summary.js), encima
de los números de detalle:

- Magnitudes (peso medio, 1RM estimado, peso máximo, tiempo, altura): «+7,5 kg desde agosto», «−1,2 kg desde el
  20 sep» o «Estable: ±0,4 kg en el periodo» (peso: ±0,3 kg es ruido). Los extremos se promedian (hasta 3 puntos
  por lado) para que una sesión rara al principio o al final no decida la frase.
- Totales semanales (carga, km): «Media 24 km/sem · +12 % frente al periodo anterior» (semanas completas; sin un
  periodo anterior entero, solo la media).
- Sin color de juicio (subir de peso puede ser bueno o malo según tu objetivo) y nunca NaN ni signos dobles.
- El periodo elegido (4 sem · 3 meses · …) ya se recordaba por pantalla (localStorage, charts.getPeriod).

## 13. Nada cortado con «…»

Las guardas visuales fallan si un texto se corta con «…» con los datos de prueba. En vez de cortar: las cifras de
las casillas (KPI) y sus etiquetas parten en los espacios y los nombres largos de las listas también. Un título de
pantalla que no cabe pasa a 18 px y hasta dos líneas (ui.js `fitTitle`, clase `.topbar-long`); la cabecera no cambia
de altura y su altura real se publica en `--topbar-h` (`watchTopbar`) para que «ir a» no deje nada bajo ella.

## 14. Valores imposibles o muy raros (js/sanity.js)

Tres clases por campo: **imposible** (no se guarda y se dice qué revisar), **muy raro** (se guarda, pero se pregunta
«¿Seguro?» con «Corregir» / «Sí, …») y **normal**. Los límites son amplios a propósito: un récord del mundo o un
ultra real nunca es «imposible».

- Series de fuerza: 900 kg en banca → «¿Seguro? Has puesto 900 kg. ¿Es correcto?»; más de 1000 kg → no se registra.
- Peso corporal: fuera de 35–200 kg pregunta; fuera de 20–400 kg no se guarda.
- Actividades (se guardan solas): un dato imposible (10 km en 2 min, FC 600) no llega al disco; el estado dice
  «Sin guardar: revisa los datos» y «Listo» no deja salir. Uno muy raro (FC 220) se guarda y se pregunta al pulsar
  «Listo». Un cambio de tipo confirmado se guarda siempre (tiene «Deshacer»); si deja datos imposibles para el tipo
  nuevo, el estado dice «Guardado: revisa los datos».
- FC en lpm, cadencia en ppm, ritmo en min/km (natación: /100 m), bici en km/h.

Pruebas: tests/unit/sanity.test.mjs, tests/e2e/sanity.test.cjs (Chromium y WebKit).

## 15. Formatters en los bordes

Ningún texto visible puede decir NaN, undefined, Infinity ni «+-». Revisado y probado
(tests/unit/formatters-boundary.test.mjs): una fecha inválida se ve «—»; un ritmo de una hora o más por km se ve
«—» (y el aviso dice «Más de una hora por km» en vez de «6:12:00 /km»); una serie con un número no finito se trata
como vacía; un desnivel negativo se escribe «−1 m» con el signo menos tipográfico.

## 16. «Deshacer»

Auditoría de las 27 acciones con «Deshacer» y de los borrados sin él (sesión, series, ejercicios de la sesión,
actividades, peso, check-in, contexto, carreras, marcas, ejercicios, rutinas, objetivos, eventos, importación).
Reglas que cumplen todas:

- **Una sola vez**: tocar «Deshacer» dos veces no restaura dos veces (ui.js `undoToast`).
- **Exactamente como estaba**: el registro vuelve igual (con su id y sus enlaces); el cursor de la sesión también;
  si borrar una actividad cambió la duración automática de su sesión de fuerza, «Deshacer» la devuelve.
- **Se ve al instante**: si al tocar «Deshacer» la pantalla visible ya no es la que borró (p. ej. borrar un evento
  entrando desde Hoy y volver a Hoy), `undoToast` la vuelve a pintar tras restaurar.
- **Nada destructivo sin red**: cambiar el ejercicio de un ítem (sesión o rutina), sustituir o quitar una zona del
  check-in, vaciar un borrador recuperado o la lista de importación ahora tienen «Deshacer».
- Un ejercicio con marcas históricas no se borra (se archiva), como uno con sesiones, rutinas u objetivos.
- Borrar una sesión abierta desde su resumen vuelve a la pantalla de origen (no a «Esta sesión no existe»).

Pruebas: tests/e2e/undo.test.cjs (Chromium y WebKit), tests/unit/library.test.mjs (marcas en exerciseUsage).
