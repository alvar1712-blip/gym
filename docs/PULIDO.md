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
- Sin semana tipo (ronda 8, B2): un perfil nuevo ya no hereda la semana de ejemplo (`defaultSettings().weekPatterns`
  es `[]`; la de ejemplo es `seed.exampleWeekPatterns()`, solo en Ajustes › Semana tipo «Usar la semana de ejemplo» y en
  datos antiguos cuyos ajustes no guardaban semana). La bienvenida tiene un paso «Tu semana» (solo si no hay semana
  tipo): días de entreno y, por día, una rutina o una sesión libre; «Saltar» no guarda nada. Sin semana, Hoy no dice
  «Te toca hoy · Descanso»: «Sin semana planificada · ¿Qué entrenas hoy?» con «Empezar sesión libre» (verde), «Elegir
  una rutina» y «Planificar tu semana»; la mini semana no muestra «Mañana». `plan.hasWeekPattern()` es la única
  comprobación. Usuarios existentes y copias restauradas conservan su semana tal cual (tests/e2e/week-setup.test).
- Verde (ronda 8, A3): solo la acción principal («Empezar» / «Continuar», el único botón verde), lo seleccionado
  (hoy en la mini semana, el check-in) y los estados positivos («Subir peso», el progreso de un objetivo). Los enlaces
  secundarios («Ver ciclo», «Importar desde un archivo», «Ver todo», «Calendario», «Panel semanal»…) van en texto
  secundario con la flecha gris; «Ahora: …», el próximo evento y el cronómetro, en texto normal; «Guardar» del peso,
  botón secundario. Reglas en css/calendar.css (bajo `.today`, no cambian otras pantallas); lo vigila
  tests/e2e/today-green.test.cjs.

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
- Ronda 8 (B4) · estancamiento frente a doble progresión: UNA decisión (`progression.progressionHint`, con el
  historial del ejercicio) para la sesión y el panel; consulta progreso reciente y estancamiento
  (`progressStatus`/`stallEval`, la regla de «Ejercicios estancados», que también usa el análisis), RIR, tope del
  rango y confianza. Por orden: estancado → «Estancado · revisar» (icono de gráfica; botón discreto, neutro, al progreso del
  ejercicio; VoiceOver: «Llevas 3 sesiones sin progresar»; el panel no lo pone en «Subir»/«Mantener» y en
  «Ejercicios estancados» añade su siguiente paso y, si llegó al tope, que quizá solo falta subir el peso); datos
  ambiguos (al tope sin RIR registrado, o la última vez hace ≥ 4 semanas) → «Mantén y reevalúa» (panel: «Mantén y
  vuelve a evaluar»); al tope → «Sube a …»; si no → «6/6/6 → +2,5 kg». Las formas cortas caben junto a «Objetivo
  3×4–6» a 375 px (progression-decision.test, también al 150 %). Nada cambia la rutina ni el volumen: sugiere.
- Resumen: dos cifras protagonistas (duración y series de trabajo; «1 h 10 min» en una línea, sin partir) y una
  línea con esfuerzo, volumen y carga. Récords (ronda 8, A6): sin récord no sale nada (ni «Récords 0 / ninguno esta
  vez»); con récord, tarjeta dorada `.ses-sum-prs` justo bajo la cabecera, «🏆 2 récords en esta sesión» y, por
  serie, el ejercicio, la serie y qué récord es (session-polish.test y session.test). «Frente a la anterior» (js/session-compare.js): la sesión terminada anterior de la MISMA rutina; por
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
- Guardar o borrar espera al disco y luego sale de la ficha: si entretanto el usuario ya se fue a otra pantalla, ese
  «atrás» tardío no se hace (router.js `screenToken` / `backFrom` / `navigateFrom`). Antes, con el disco lento,
  borrar una marca y tocar Hoy enseguida devolvía a la ficha borrada.

Pruebas: tests/e2e/undo.test.cjs (Chromium y WebKit; incluye el disco lento), tests/unit/library.test.mjs (marcas en
exerciseUsage).

## 17. Accesibilidad

Auditoría (31 problemas confirmados por verificación independiente, 1 descartado) y arreglos:

- **VoiceOver**: al abrir una hoja el foco entra en su título y lo de detrás queda inerte; al cerrarla vuelve a lo
  que la abrió. Al cambiar de pantalla el foco va al título y `document.title` es «<título> · Entreno». Registrar o
  editar una serie ya no tira el foco al principio de la página. Los avisos se anuncian desde dos regiones vivas
  fijas (cortés y, para errores, inmediata); el de «Deshacer» no se cierra mientras tiene el foco. Grupos de fichas
  (RIR, RPE, tipo de sesión…) con nombre; botones −/+ que dicen a qué campo afectan («Sumar 2,5 a Peso»); filas
  de serie con tipo, récord y nota; gráficas con su descripción y el último valor; hoy marcado con
  `aria-current="date"`; pestaña activa con `aria-current="page"`; ningún `<button>` con rol de celda o de lista.
- **Texto del sistema (Dynamic Type)**: los tamaños son `calc(Npx * var(--ts))`; app.js lee `-apple-system-body`
  (iOS: Ajustes › Pantalla y brillo › Tamaño del texto) y fija `--ts` entre 1 y 1,5. Con el texto grande
  (`html.text-large`) lo que a 100 % se recorta ocupa más líneas, los botones pueden ir en dos líneas, las
  etiquetas van encima de su control y las tablas de cifras crecen menos. La etiqueta de la barra de pestañas no
  crece (como en iOS). A 100 % nada cambia.
- **Contraste**: rosa de la regla #c94564 (texto blanco ≥ 4,5:1), gris de «Descanso» #858d9b, placeholders en
  `--muted`, días de otro mes con el número en `--muted` (sin opacidad). Con «Aumentar contraste» (prefers-contrast)
  bordes y textos secundarios más marcados.
- **Movimiento y transparencia**: todo el desplazamiento por código usa `scrollBehavior()` (instantáneo con
  «Reducir movimiento»); con «Reducir transparencia» la cabecera compacta, el pie de importar, la barra del
  periodo y el pie de la actividad son opacos.
- **Foco visible** con teclado: anillo verde (dentro de las filas de lista, para que no lo recorte la lista).

Guardas: tests/e2e/visual-guard.test.cjs recorre todas las pantallas también con el texto al 125 % y al 150 % y,
además de lo anterior, falla si un texto se sale de su caja (un botón, una ficha) o se corta a N líneas (salvo los
avances marcados con `data-preview`, cuyo texto entero está a un toque).

## 18. Modo foco en la sesión en curso

En `#/session/<id>` de una sesión de fuerza **en curso** (y solo ahí) la cápsula de la barra de pestañas muestra la
barra de la sesión: «‹ Hoy» · «En sesión · 2/20 series» · «Terminar» (ui.js `focusBar`, js/views/session.js).

- Es el mismo elemento `#tabbar` (mismo sitio, áreas seguras, inerte con una hoja abierta): el hueco de abajo del
  contenido, los avisos y el código que esquiva la barra (`visibleBottom` de la sesión) siguen valiendo.
  `html.focus-mode` sube `--tb-h` a 56 px (64 px con texto grande) para que los botones tengan 44 px con aire.
- n/N es `calc.setProgress` (la misma cuenta que «2 de 20 series» en Hoy). Sin cronómetro de descanso; el de la
  sesión sigue en la cabecera, que ya no repite «Terminar».
- No encierra: «Hoy» sale sin cerrar nada (Hoy muestra la sesión con «Continuar»); el «atrás» de la cabecera
  también. Fuera de esa pantalla (Hoy, Progreso, la ficha de un ejercicio, una sesión terminada, el resumen)
  vuelven las pestañas.
- Texto grande: «Hoy» se queda en la flecha (VoiceOver dice «Ir a Hoy»), «Terminar» sin icono y n/N sin la palabra
  «series»; la letra no se reduce.

Pruebas: tests/e2e/focus-bar.test.cjs (Chromium y WebKit, 375/390/430, texto 100 % y 150 %: la barra cabe, nada
de la pantalla queda bajo ella, n/N se actualiza, «Hoy» sale con la sesión abierta y «Terminar» la termina).

## 19. Texto grande sin solapes (ronda 8, A2)

Con el texto al 150 % había fallos que la guarda no veía porque nada «se salía de su caja»: el texto del anillo del
ciclo pisaba el trazo, «00» se montaba sobre «min» (y «80,8» sobre «kg»), «Senderismo» se partía en
«Senderism|o», «RECUPERACIÓ|N» y «Señales de / cansancio» en «Cómo vas», «Energí|a» en la tabla del ciclo… Arreglos
(sin bajar la letra, todo bajo `html.text-large`, salvo dos casos que también rozaban al 100 %):

- **Anillo del ciclo**: crece hasta 290 px; dentro quedan el rótulo y el día; la fase y «estimada» pasan debajo
  (rejilla que superpone dibujo y centro). El anillo pequeño de Hoy pasa a 76 px.
- **Unidades superpuestas** (−/+, duración h·min·s): la unidad va debajo de la cifra y el campo crece en alto.
  Al 100 %, «28 días» (Perfil) y «42,5 kg» (sesión, 375 px) se tocaban: la cifra se centra en el hueco que deja la
  unidad.
- **Columnas → filas**: selector de deporte en flex (cada opción mide al menos su palabra), accesos rápidos de Hoy
  y de Progreso de dos en dos, «Más datos» de la actividad un campo por fila, tablas por músculo con el nombre en su
  línea, «Cómo vas» con la minigráfica y el estado debajo, carga por deporte en dos líneas, «Más progresan» con el
  cambio debajo, «Tus ciclos» de dos en dos, columnas de «Cómo te afecta» a la medida de su título.
- **Filas de lista con cifra a la derecha**: el texto no encoge por debajo de su palabra más larga; la cifra baja de
  línea si no cabe y la flecha queda fija a la derecha.
- La cabecera de la actividad se vuelve a medir al cambiar el título («Nuevo senderismo» se cortaba con «…»):
  ui.js `fitTitle` exportada.

Guarda (tests/e2e/visual-guard.test.cjs, `overlapIssues`), en todas las pantallas y tamaños:

- **palabra partida**: una palabra de 2–14 letras repartida en dos líneas;
- **valor sobre su unidad**: el valor (o el ejemplo, en Chromium) de un campo con unidad superpuesta pisa la tinta de
  la unidad, o no cabe en el campo;
- **texto sobre un anillo**: una línea de texto que toca un círculo SVG con trazo y no cabe entera en su hueco.

Una prueba propia (`la guarda de solapes avisa…`, Chromium y WebKit) monta cada caso roto y su arreglo y comprueba
que la guarda avisa del primero y calla con el segundo; con el CSS anterior, la guarda falla en #/cycle, #/today,
#/activity/new, #/progress, #/bodyweight y #/settings/thresholds. «Senderismo» al 150 % se recorre también
(`activity-new-hike`).

## 20. Deltas comparativos: neutros por defecto (ronda 8, A4)

Un solo camino para colorear una diferencia frente a otro periodo o sesión: `deltaTone(dir, { better, warn })` de
`js/util.js` → `'neutral' | 'good' | 'warn'`. Subir no es «bueno» ni bajar «malo»: «Carrera 0 km · ▼ −100 %» a
mitad de semana va en gris, como cualquier cambio sin regla detrás.

- **good** solo si una regla dice qué dirección es mejora y la diferencia va en ella: 1RM en «Ejercicios que más
  progresan» (#/summary) y más kg o reps en «Frente a la anterior» (resumen de sesión). Bajar ahí es neutro.
- **warn** solo si el analista ya avisa de esa subida en esa semana: en «Resumen de la semana» (#/weekly), «Carga» si
  hay `load-warn` y los km de carrera si hay `runkm-warn` (sugerencias de `insights.js`), y nunca en un ▼.
- Todo lo demás (#/summary «Comparación», KPIs y deportes, panel semanal sin avisos), neutro. «Cómo vas» ya era
  texto neutro con su estado (`stateTag`) decidido por `overview.js`.

Chips: `deltaChip(d, fmt, rule)` (views/summary.js) pone `data-tone` y `.sum-delta-tone-*`; las filas de sesión,
`data-tone` en `.ses-cmp-row`. Pruebas: `tests/unit/util.test.mjs` (deltaTone) y `tests/e2e/deltas-neutral.test.cjs`.

## 21. Ficha de ejercicio y su gráfica de progreso (ronda 8, A5)

- **Ficha (#/exercise/:id)**: arriba, «de un vistazo» (`.lib-glance`): «Última vez · 5 oct · hace 2 días» con sus
  series, «Mejor serie» (la del récord de 1RM estimado; sin 1RM, la de más peso, reps, tiempo o altura), «1RM
  estimado» (el de la última sesión y el récord) y la tendencia de los 3 últimos meses. Debajo, «Ver progreso» y el
  historial; al final, los metadatos (músculos, patrón, alias, rutinas) y las acciones. Sin sesiones terminadas, la
  tarjeta no sale.
- Los números salen de `stats.exerciseGlance`, que solo reúne `exerciseSummary`, `exerciseSeries` y `exerciseRecord`
  (Epley de calc.js) y la frase de `levelSummary`: nada se calcula dos veces. La tendencia es la MISMA frase que la de
  la gráfica con el periodo por defecto (3 meses).
- **Métrica principal** (`stats.exercisePrimaryMetric`): el 1RM estimado si hay series con carga de 1–12 reps; si no,
  lastre o repeticiones (peso corporal), tiempo o altura. Va primero en los datos clave y en las gráficas de
  #/progress/exercise/:id.
- **Redondeo humano**: `stats.EXERCISE_METRIC_SUMMARY` (como mucho un decimal): «−1,7 kg desde julio», nunca
  «−1,67 kg».
- **Ejes con rango mínimo**: `lineChart({ yMinSpan })` amplía el eje alrededor de los datos si ocupan menos de ese
  rango (`charts.widenDomain`, sin cruzar el cero); las gráficas del ejercicio usan `relativeSpan(0.2, mínimo)` (al
  menos el 20 % del valor: 5 kg, 4 reps, 10 s, 5 cm…). Antes, 45 → 40 kg ocupaba todo el alto (eje 40–45).

Pruebas: tests/unit/exercise-glance.test.mjs y tests/e2e/exercise-glance.test.cjs (Chromium y WebKit).

## 22. Punto de restauración antes de importar o «Borrar todo» (ronda 8, B3)

En iOS no hay una descarga automática fiable sin un gesto del usuario, así que la protección tiene dos partes, y
ninguna promete más de lo que da:

- **Punto de restauración local, automático y comprobado** (`store.importData` y `store.wipeAll`, la única vía de
  ambos): antes de destruir nada, `createRestorePoint` guarda una copia completa (la misma de `exportData`) en dos
  registros reservados de `meta` (`~restorePoint`: fecha, motivo y recuentos; `~restorePoint:data`: la copia), la
  RELEE del disco y comprueba recuento por almacén y contenido idéntico. Si no se puede escribir (p. ej. sin espacio,
  `QuotaExceededError`) o no coincide, lanza `RestorePointError` y no se toca nada; la pantalla lo explica («No se ha
  borrado nada… Tus datos siguen intactos») y ofrece exportar una copia.
- **Exportar antes** (gesto del usuario): la primera confirmación de importar y de borrar todo tiene «Exportar copia
  antes» (la hoja de compartir sale del propio toque). Solo se sigue si la copia se guardó.

Reglas:

- **Sin subir la versión de la BD**: los registros con id que empieza por «~» (db.js `RESERVED_PREFIX`) quedan fuera
  de la carga inicial (`getAll` de `meta` con rango de claves), de la memoria, de las copias exportadas y de
  «sustituir todo» (`replaceAll` borra solo el rango de la app). Una copia importada no puede traer uno (se quitan).
- **Uno solo, el último**. Si ahora no hay nada que proteger (la app está como recién instalada) se conserva el
  anterior: borrar dos veces seguidas no pisa los datos de verdad. «Algo que proteger» (`store.hasDataToProtect`) es
  cualquier diferencia con lo sembrado: registros, ejercicios propios o editados, rutinas propias, editadas o borradas,
  la semana tipo o el perfil (revisión de B3: antes solo miraba registros y ejercicios propios, y quien había
  preparado rutinas, semana y perfil sin entrenar aún los perdía sin punto). Lo que se guarda solo (fecha de la
  última copia, avisos descartados) no cuenta, para no pisar el punto con una app vacía.
- **Recuperar** (Ajustes › Copias y datos › «Punto de restauración», con fecha, motivo y recuentos; doble
  confirmación): en UNA transacción vuelven los datos del punto y lo de ahora pasa a ser el nuevo punto (se puede
  volver); si lo de ahora no tenía datos, el punto se consume. «Eliminar este punto» lo quita del dispositivo (p. ej.
  tras borrar todo para no dejar nada).
- **Honestidad**: la tarjeta y las confirmaciones dicen que vive solo en este iPhone, dentro de la app, y que si se
  borran los datos del sitio (o el sistema los elimina) también se pierde: no sustituye a una copia exportada.
- Doble confirmación conservada: borrar todo sigue pidiendo escribir BORRAR; importar exige elegir un archivo y
  confirmar «Sustituir todo» (y otra vez si antes se exportó, porque ese toque fue para exportar).

Pruebas: tests/e2e/restore-point.test.cjs (Chromium y WebKit): cancelar no crea punto; borrar → recuperar y
importar → recuperar → volver dejan memoria y disco idénticos por almacén; el punto no va en la copia; sin espacio o
con una relectura distinta no se borra ni se importa nada; exportar antes; sin datos se conserva el punto; eliminar.
La guarda visual recorre `settings-data-rp`.
