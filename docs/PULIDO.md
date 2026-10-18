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

- 44 px de alto como mínimo para cualquier botón, enlace o campo, también los compactos (`.btn-sm`), y 44 px de ancho
  para botones y fichas (con su área ampliada; excepciones explícitas en §30).
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
- cada icono junto a su texto y sin encogerse; ningún emoji solo en su línea (§29);
- el texto atenuado con opacidad, ≥ 4,5:1 (≥ 3:1 si es grande) sobre su fondo (§17);
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
- Ronda 9: esa frase solo sale si algo se ha podido **valorar** (un análisis que no sea «faltan datos» ni de confianza
  insuficiente, o un mensaje del panel con veredicto «Bien» o «Atención»). Sin avisos y sin nada valorado: «Aún pocos
  datos para valorar tu evolución: sigue registrando.», con el icono de reloj en gris (`.focus-fewdata`,
  `.an-fewdata`), nunca el check verde; en #/analysis el resumen se titula «Aún pocos datos».
- Ningún «Bien» afirma lo que los datos no dicen: con ejercicios estancados o bajando, nada en «Bien» dice que tus
  ejercicios progresan; con objetivo de ganar músculo, bajar de peso no es «Bien». Lo vigila la prueba cruzada
  tests/unit/analysis-consistency.test.mjs (junto con «descarga» solo con la regla del panel, una sola decisión de
  volumen por músculo y nada de kcal ni «déficit» para menores).
- Panel semanal, series por músculo: la frase cuenta como la leyenda del mapa (`bodymap.statusOf`: 0 series → «sin
  series»), p. ej. «2 en rango, 7 por debajo y 7 sin series». El aviso «N músculos por debajo» sigue contando los que
  no llegan al mínimo (también con 0 series) y, para que cuadre con la frase, dice «De ellos, K sin ninguna serie».
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
- «Estable» dice siempre la oscilación que se ve (± la mitad del rango), también cuando el cambio redondea a 0: nunca
  «±0 reps» con puntos de 6 a 10 (auditoría final).
- La gráfica no contradice la frase: cada una tiene su **rango mínimo de eje** (`yMinSpan`, nunca uno global): peso
  `BODYWEIGHT_SPAN` = `relativeSpan(0.025, 2)` (Progreso, #/bodyweight y Análisis), ritmo de carrera y natación
  `relativeSpan(0.05, 20)` s, bici `relativeSpan(0.1, 3)` km/h y las del ejercicio (§21). Antes, 76,6–77,2 kg con
  «Estable: ±0,1 kg» dibujaba una joroba de medio alto.
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
- **Atenuar con color, nunca con `opacity` sobre texto** (auditoría final): la opacidad mezcla el texto con el fondo
  y lo deja por debajo de 4,5:1 aunque su color pase. Lo «apagado» va en `--muted` / `--st-pending` (≥ 4,5:1 sobre
  `--surface`, `--surface-2` y `--surface-3`, y más claro con «Aumentar contraste»); la `opacity` queda para lo que no
  es texto (puntos, muestras, barras) y para los controles `:disabled`. Así: días por llegar del calendario del
  Resumen (`--muted`, frente a `--text-2` de los pasados; antes 2,07:1), series pendientes (borde discontinuo, número
  y valor en `--st-pending`; antes 4,06:1), leyenda del mapa corporal sin zonas (texto en `--muted`, solo la muestra
  atenuada; antes 2,81:1). Sobre el verde suave de una ficha principal, `--muted` no llega (4,48:1): ahí, `--text-2`.
  La guarda visual (§4, `contrastIssues`) mide todo texto con opacidad acumulada < 1 —la suya o la de un antepasado—:
  su color mezclado sobre la pila de fondos debe dar ≥ 4,5:1 (≥ 3:1 si es texto grande); no cuentan `:disabled`,
  lo `aria-hidden` ni una opacidad en plena animación.
- **Movimiento y transparencia**: todo el desplazamiento por código usa `scrollBehavior()` (instantáneo con
  «Reducir movimiento»); con «Reducir transparencia» la cabecera compacta, el pie de importar, la barra del
  periodo y el pie de la actividad son opacos.
- **Desplazar la página por código: `ui.scrollPageTo(top)`**, no `window.scrollTo` suelto. El desplazamiento suave
  lo puede cancelar el motor (WebKit al sustituir contenido) o arrastrar una animación anterior pendiente
  (Chromium: «Siguiente pendiente» a veces no movía la página). `scrollPageTo` comprueba a los dos fotogramas que
  se acerca y, al acabar el tiempo de la animación, que ha llegado; si no, coloca la página. Si el usuario toca,
  arrastra o pulsa una tecla entretanto, manda él. Con «Reducir movimiento», colocación instantánea.
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
- Ronda 8 (H): el centro es el botón «Siguiente pendiente» (⌄ junto a «En sesión»; con texto grande, junto a n/N).
  Ver §26.

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

## 23. Contexto dentro de las gráficas (ronda 8, E)

Reglas de UI (detalle en docs/MEJORAS.md §9):

- El contexto va en una **franja superior** de la gráfica (margen de arriba 18 px en vez de 10), nunca como bandas de
  fondo: las franjas verticales quedan para la regla. Apagado, la gráfica no cambia ni un píxel.
- **Un solo color neutro** (`--text-2`): fases al 45 % en una fila (unión de las que se solapan), hechos como puntos
  (relleno = día exacto, hueco = mes). Sin colores por tipo, sin texto en la franja: los nombres van en el globo.
- **Globo**: una línea de contexto como mucho (`.chart-tip-ctx`, sin saltos, «…»), hechos primero y fases por
  prioridad con «+N». El globo de un hecho es una línea «15 sep · Inicio creatina».
- **Interruptor «Contexto»** al final de la leyenda, ≥ 44 px, `aria-pressed`, sin animación; con texto grande baja a
  su fila. Solo existe si hay contexto en el periodo. Barras con ruido (carga, km): apagado por defecto.
- La descripción accesible de la gráfica nombra como mucho 3 elementos de contexto y «y N más».

## 24. Recuperación: bloques sin juicio (ronda 8, F)

Reglas de UI de `#/recovery` (detalle en docs/MEJORAS.md §10):

- **Escalas de 1 a 3 en bloques**, no en líneas: una celda por día, semana o mes, con una rampa neutra (`--text-2` al
  28 / 60 / 100 %: tenue = bajo, intenso = alto) y un contorno discontinuo sin datos. Sin rojo ni verde: el bloque no
  juzga; lo interpretan las frases del analista, con su confianza.
- La tira es una imagen accesible (`role="img"` con su resumen); las celdas, ocultas a VoiceOver.
- Medias y «antes» en texto secundario neutro; con menos de 4 días no hay medias, solo los bloques y la nota.
- Las zonas: secuencia en cifras tabulares y estado con `stateTag` (Mejorando · Estable · Empeorando), con la regla
  y «no es un diagnóstico» siempre a la vista.
- Texto grande: etiqueta y resumen en columna; sin animaciones. Prefijo CSS `rcv-` (en css/progress.css).

## 25. Puesta a punto: contexto, nunca aviso (ronda 8, G)

- Una bajada de carga cerca de un evento A o B no se pinta como negativa: «Carga semanal» sigue en **neutro**, con la
  etiqueta «Puesta a punto» (`stateTag('info', …)`, el azul de información, nunca ámbar) y la frase al final del texto.
  El chip de «Carga» del «Resumen de la semana» sigue con `deltaTone` sin regla (neutro): una bajada nunca es `warn`.
- La frase interpreta, no prescribe: «Compatible con una puesta a punto antes del 10K del domingo.» Sin porcentajes de
  taper ni consejos; el único % es la variación que ya estaba.
- Texto grande (arreglos que la nueva pantalla de la guarda destapó en cualquier semana pasada): «Ir a esta semana»
  pasa a dos líneas en vez de cortarse con «…» y, en las fichas del resumen, la diferencia larga («−4 h 13 min»,
  «−33.207 kg») parte por sus espacios en vez de salirse; el % sigue entero.
- Guarda visual: pantalla `weekly-taper` (semana pasada con «Puesta a punto» y su «¿Por qué?» abierto).

## 26. Sesiones largas: lo terminado, plegado (ronda 8, H)

- Plegar solo en momentos naturales (tras el ✓ de terminar, al saltar, al volver a pintar la lista), nunca mientras se
  toca la tarjeta: nada se mueve bajo el dedo. Lo plegado sale de los datos; lo tocado a mano, en memoria.
- La línea plegada es un único botón de 44 px con `aria-expanded`; el nombre pasa a dos líneas antes que cortarse con
  «…» y, con texto grande, el resumen («3 series») baja a su propia línea. Al plegar o desplegar a mano, el foco vuelve
  al botón del bloque nuevo.
- «En curso» = «2/4» discreto en la cabecera; no añade alto. Un grupo se pliega entero, nunca un ejercicio suelto.
- El salto vive en la barra de la sesión (§18), sin botón nuevo: el centro «En sesión · n/N» con ⌄. Desactivado sin
  pendientes, sin atenuar (sigue informando).
- Entrada al desplegar: solo opacidad y −6 px (`session-view-card.reveal`); sin animación y con desplazamiento
  instantáneo con «reducir movimiento».
- Guarda visual: pantalla `session-long` (superserie y cuatro plegados, uno desplegado a mano y otro en curso).


## 27. Arranque: el logo de Entreno, no un estado de carga

Antes: `#view` traía «Entreno / Cargando…» (texto pequeño) mientras cargaba, y el router lo sustituía por Hoy en
cuanto montaba: pantalla negra → texto técnico → Hoy (con las tarjetas apareciendo después).

Ahora (index.html `#splash`, js/app.js `hideSplash`):

- **Qué se ve**: el símbolo del icono (icons/mark.svg = las formas de icons/icon.svg sin el fondo) a 84 px de caja
  (~76 px de dibujo), centrado; «by Álvar» a 13 px en gris (#6b7280), 32 px por encima de la safe area inferior.
  Probadas A (solo logo) y B (logo + «Entreno» en blanco): B compite con el logo y lo descentra; se queda A.
  Sin «Cargando…», spinner, barra ni porcentaje.
- **Primer fotograma**: estilos y SVG en línea en index.html (no espera a las hojas de estilo ni a ninguna petición).
- **Duración**: `máx(800 ms desde que se ve, Hoy listo)`. Hoy listo = el router ha montado y las tarjetas de Hoy
  terminaron (`.today-extra[data-ready]`, con un tope de 1,5 s tras montar: si tardan más se entra igual; nunca se
  esconde una lentitud). Nunca se suma el mínimo a un arranque lento.
- **Entrada**: logo `opacity 0→1` + `scale(.96)→1` en 260 ms; la firma, un fundido 120 ms después. Abierta desde la
  pantalla de inicio de iOS (`navigator.standalone`): sin animación de entrada, porque la imagen de arranque de iOS
  ya enseña el mismo logo en el mismo sitio (no parpadea).
- **Salida**: el splash funde en 220 ms con Hoy YA montado y completo debajo, y sale del DOM (no quedan capas).
  Mientras está, `#app` es `inert` y el splash recibe los toques: no se pulsa nada de Hoy por accidente.
- **Movimiento reducido**: sin animaciones; salida en 60 ms; se mantiene el tiempo mínimo.
- **Un mismo fondo**: `#0b0d10` en `--bg`, `html, body` en línea, `theme-color`, `background_color` y
  `theme_color` del manifest, el splash y las imágenes de arranque.
- **iOS**: `apple-touch-startup-image` para 11 tamaños de iPhone (splash/*.png, generadas con
  `scripts/make-splash.cjs` desde el mismo `#splash` de index.html, con la safe area de cada modelo). iOS las lee al
  **añadir a la pantalla de inicio**: una instalación anterior las verá tras quitar y volver a añadir el icono.
  iOS decide si y cuánto enseña su imagen; la nuestra sigue igual detrás. «by Álvar» en esas imágenes usa la fuente
  del generador (Linux), no la del sistema del iPhone: puede notarse un matiz en esa línea, no en el logo.
- **Cuándo aparece**: solo al cargar la página (arranque en frío, recarga o tras actualizar el service worker).
  Volver a la app que estaba en memoria no la enseña.
- Tiempos en `window.__boot` (t0, storeReady, mounted, appReady, fadeStart, interactive, relativos a t0) y en
  `npm run perf` (columnas «funde» y «toque»). Pruebas: tests/e2e/splash.test.cjs.

## 28. Formularios con «Guardar»: borrador y check-in a medias (auditoría final)

- **Borrador** (ui.js `formDraft`): los formularios que solo guardan al pulsar «Guardar» (eventos deportivos, marcas
  históricas y contexto, nuevos y en edición) guardan lo tecleado en localStorage a cada cambio
  (`entreno.raceDraft:<id|new>`, `entreno.pastRecordDraft:…`, `entreno.contextDraft:…`). Al volver (recarga de iOS,
  «atrás») sale arriba «Borrador recuperado · Vaciar» (`.form-draft`), como en actividad, objetivo y ejercicio nuevos;
  «Vaciar» se deshace. Guardar o borrar lo quita; si el registro cambió por otro lado (otra pantalla, una copia
  restaurada) el borrador viejo se descarta y nunca lo pisa. El de un evento no lleva su resultado (lo guarda su
  tarjeta). Fuera de IndexedDB y de la copia; «Borrar todos los datos» e importar lo quitan.
- **Check-in a medias en Hoy**: la tarjeta sigue saliendo (con lo contestado, `data-state="partial"`) hasta que se
  completa. «Omitir» solo aparece sin nada contestado (no guarda nada); a medias, «Listo» la cierra por hoy y conserva
  lo contestado (con «Deshacer»). Completo, omitido o cerrado: Hoy no lo vuelve a ofrecer ese día; con un «después»
  ya contestado (ya entrenó), tampoco.
- **Evento con su objetivo borrado**: el enlace roto no bloquea; la ficha avisa «El objetivo enlazado se borró» y el
  evento se guarda sin objetivo. Borrar un objetivo avisa «Hay N eventos enlazados; quedarán sin objetivo».

## 29. Icono + etiqueta (auditoría final)

Un icono (SVG de `ui.icon` o emoji en su span) delante de su texto en un botón, una baldosa, una fila de lista o una
cabecera sigue cuatro reglas de sistema, no de cada pantalla:

1. **El icono nunca se encoge.** `.icon { flex: none }` global (css/app.css); `icon()` ya pone la clase. Sin ella, un
   ítem flex cedía ancho cuando el texto no cabía y el icono quedaba de 4–16 px con el texto grande. Lo que se adapta
   es la etiqueta.
2. **Una etiqueta junto a un icono nunca se centra por dentro.** El centrado lo hace el contenedor
   (`justify-content`); la etiqueta va `text-align: start` (`.btn:has(> svg.icon)`, `.prg-link-wide .prg-link-label`,
   `.imp-settings-label`). Una etiqueta centrada que parte de línea ocupa todo el ancho y cada línea centrada aleja
   el primer glifo 30–50 px del icono («⏱️ Tiempos previstos» en Progreso a 375–430 px, «Registrar síntomas» al
   125 %). Los botones sin icono siguen centrados. Si la etiqueta parte de línea, su caja ocupa todo el ancho libre
   (CSS no ajusta una caja al ancho de sus líneas): en un grupo de baldosas iguales, todas van al inicio
   (`.prg-link-wide`, como «Análisis»), así los emojis forman columna y ninguna queda cargada a un lado; en un botón
   suelto se acepta que el conjunto quede algo cargado al inicio, mejor que un icono a 30 px de su texto.
3. **El emoji en caja fija no escala** (o la caja escala con él): `.goal-emoji` va a 26 px (22 px por debajo de
   380 px), como las baldosas. Antes crecía con el texto y al 150 % se montaba en el título (−3 px).
4. **Distancia entre el icono y el primer glifo**: la del `gap`, de 4 a 8 px en línea y de 10 a 14 px con baldosa, igual
   a 100, 125 y 150 %. El icono va centrado con la primera línea o con el bloque. Un número no se queda solo en la
   segunda línea: «Registrar serie 3» lleva un espacio duro.

La guarda visual (§4) lo comprueba en cada pantalla: `iconGapIssues` (para `.btn`, `.prg-link-wide`, `.list-item` y
las cabeceras `*-head` en fila con el icono como primer hijo: primer glifo − icono ≤ gap + 6 px y ≥ 2 px, medido con
Range; un emoji sobre baldosa se mide desde la baldosa) e `iconShrinkIssues` (ningún `svg.icon` más estrecho que su
`width`). No cuentan los iconos detrás del texto («Ver progreso ›») ni la salida del modo foco (§18). Su prueba propia
monta un caso roto y su arreglo de cada regla.

5. **El emoji que encabeza una etiqueta va oculto a VoiceOver y pegado a su primera palabra**:
   `h('span', { 'aria-hidden': 'true' }, '🎯\u00a0')` + el texto. El espacio no separable impide que al 150 % el emoji
   se quede solo en una línea y el título baje a la siguiente («🎯 Objetivos» en Hoy y Progreso, «🏃 Carrera ·
   distancia» en el Resumen); `aria-hidden` evita que VoiceOver lea «diana Objetivos». Si la columna es estrecha, lo
   que cede es lo de al lado (la comparación del Resumen parte la diferencia entre la cifra y el %), nunca la palabra.
   La guarda `emojiOrphanIssues` lo mide con Range en cada pantalla (centro del emoji y del primer glifo siguiente del
   mismo bloque a más de 0,6 líneas → huérfano). Pendiente para otra ronda: el resto de emoji interpolados en cadenas
   (calendario, hoja de acciones, `<option>`), que necesitan separar el emoji en su propio campo.

## 30. Sesión de fuerza: olvidada abierta, fichas de RIR y «Aplicar a la plantilla» (ronda 9)

- **Sesión olvidada abierta** (session-logic `proposedDuration`, `lastActivityAt`): el límite es lo último registrado
  (la serie confirmada más reciente o el fin de la última actividad enlazada: inicio + duración si es importada; si
  no, cuándo se registró, pero como mucho su duración después de lo anterior, para que registrarla tarde, justo antes
  de terminar, no cuente como «ahora»). Si han pasado más de 60 min (`STALE_GAP_MIN`) desde ese límite, la sesión está
  olvidada: la propuesta llega hasta el límite + 5 min y `endedAt` se guarda ahí (no «ahora»), así que la duración
  automática no vuelve a «46 h» si después cambia una actividad enlazada. El criterio es el hueco, no el total: una
  sesión larga activa (fuerza + carrera de 3 h) no se recorta. Sin nada con hora, el campo queda vacío y obligatorio,
  como a posteriori. La hoja lo explica («La sesión lleva abierta 46 h: propuesta hasta tu última serie (18:00–19:05).
  Revísala.») y Hoy cambia el reloj por «Sesión sin terminar · Abierta desde el mar 13 oct» (o «desde las 10:00» si es
  de hoy) y «Terminar», que abre directamente la hoja (`#/session/<id>?finish=1`, la URL vuelve a la de la sesión).
  Las sesiones ya guardadas no se migran.
- **Fichas de RIR** (css/session.css): «Fallo» se queda (datos con `rir:'F'`, Epley y la progresión). A 100 %, una fila
  con un `::before` que cubre el hueco (≥ 40 px de área a 375 px: 7 fichas en ~293 px no llegan a 44). Con texto
  grande, «Fallo» arriba a todo el ancho y 0–5 debajo (≥ 44 px), siempre en una línea. Causa de fondo: la regla general
  `html.text-large .chip { flex: 0 1 auto }` pisaba el reparto de cada fila de fichas (RIR, RPE, zonas, RIR de marcas
  históricas) y las cifras se quedaban en 14–20 px; ahora va con `:where(html.text-large)` y manda el de cada fila.
- **¿Aplicar a la plantilla?**: por defecto solo vienen marcados «Cambiar» y «Añadir»; «Quitar» y el nuevo orden, no
  (saltarse hoy un ejercicio no es borrarlo de la rutina). Un ítem borrado de la plantilla con la sesión abierta
  (estaba en `templateItemIds` al empezar y ya no está) no se vuelve a proponer como añadido; las sesiones antiguas
  sin `templateItemIds` siguen como antes.

Guarda (§4): además del alto, ningún botón ni ficha por debajo de 44 px de **ancho**, contando el área ampliada con
`::before` (que tampoco cuenta como «texto que se sale de su caja»). Excepciones explícitas en `WIDTH_EXCEPTIONS`: las
fichas de RIR a 100 % (≥ 40) y las celdas del calendario del resumen (7 por semana, ≥ 40); las zonas del mapa
corporal (SVG) no cuentan. Pruebas: tests/unit/session.test.mjs, tests/e2e/session.test.cjs (sesión olvidada, sin
series con hora y hoja de plantilla segura), tests/e2e/large-text-rows.test.cjs (RIR a 100/106/125/150 %, Chromium y
WebKit).

## 31. Importación: saltos del GPS, archivos cortados, horas repetidas y duplicados con lo apuntado a mano (ronda 9)

- **Saltos del GPS** (import-parse `summarize` → `pointMetrics(…, { dropSpikes })` → best-efforts `buildSeries`): un
  tramo a más de `SPIKE_SPEED` (10 m/s) y de más de 5 m se quita de la serie (cada uno resta su delta a lo que viene
  después) y de la distancia a la vez, así que la distancia propuesta, la «del archivo» (`fileKm`) y los parciales
  salen de la misma cifra y la serie sigue acabando en la distancia. Solo en **carrera y senderismo** (deporte del
  archivo) y solo con la distancia **de los puntos GPS**; con la del dispositivo (FIT, TCX) o un total del archivo,
  nunca, y en bici nunca (36 km/h es normal). La tarjeta lo dice: «Descontados 0,99 km de saltos del GPS».
- **Archivos cortados**: GPX/TCX si el texto se acaba con elementos abiertos o a mitad de una etiqueta (`walkXml` lo
  marca antes del cierre forzado); FIT si la cabecera declara más datos de los que hay (sin contar el CRC final; con
  tamaño 0, no se sabe). La tarjeta avisa («El archivo parece incompleto: termina a los 5,49 km. Vuelve a
  exportarlo.»), lleva la insignia «Incompleto» y queda sin marcar (se puede marcar). Un FIT cortado sin ningún dato
  de actividad da «El archivo FIT está incompleto (la descarga se cortó). Vuelve a exportarlo.».
- **Horas repetidas**: un punto con la misma hora que el anterior que sí avanza cuenta (distancia y serie) si el tramo
  anterior o el siguiente es de movimiento y, junto con el siguiente, no supera `SPIKE_SPEED`. No se fusionan puntos.
- **Duplicados manual ↔ importada** (import-logic `likelyDuplicate`): además de la regla estricta (`isSameActivity`,
  que no cambia), una regla amplia para avisar: mismo tipo y fecha, alguna sin hora, duración a ± `RESULT_DUP_TOL`
  (5 %, la de «misma carrera» en contexto y eventos) y distancia a ± 5 % o ausente en alguna. En la importación: «Puede
  ser la misma que «Carrera» del 4 oct (apuntada a mano)», insignia «Posible repetida» y sin marcar. En el formulario
  de actividad nueva: aviso «Parece la misma actividad que…» con «Guardar igualmente» y «Ver la existente». Nunca
  bloquea ni descarta nada, y no hay filtro de duplicados en los análisis (una sesión doble real se perdería).

Las actividades ya guardadas no se migran (ni distancias ni parciales); una copia restaurada conserva lo que trae.
Pruebas: tests/unit/import.test.mjs (saltos, cortados, horas repetidas, likelyDuplicate), tests/e2e/import.test.cjs
(tarjetas de cortado y de salto; posible repetida y aviso en el formulario).

## 32. Historiales largos: listas por lotes, copias sin clones de más y un solo montaje al restaurar (ronda 9, M20)

- **Listas por lotes**: una lista que crece con los años (historial de un ejercicio, pesajes, historial de sesiones)
  no se pinta entera. El «Historial completo» de Progreso de un ejercicio pinta las 30 sesiones más recientes
  (`HIST_PAGE`) y «Ver más (N)» añade lotes de 30 al final (con 5 años eran ~480 filas, 7.500 nodos y 50.000 px). Lo
  que marca cada fila (🏆) se calcula con el historial **entero** antes de pintar: una fila marca lo mismo en el lote
  que esté. Al pintar el último lote el botón se oculta y, si tenía el foco, este pasa a la primera fila nueva.
  Al volver de una sesión abierta desde la lista se pintan las mismas filas que había (`ui.hist`, 30 min): si no, el
  router no podría devolver el scroll a una fila de un lote ampliado.
- **Copias sin clones de más**: un objeto solo se clona si alguien más lo conserva y podría cambiarlo.
  `buildBackupObject` crea objetos nuevos solo en el camino que cambia (raíz → `data` → `meta` → ajustes con
  `lastBackupAt`) y comparte el resto, sin modificar la entrada. Exportar usa `store.exportData({ clone: false })`
  (registros vivos) y lo serializa **en el mismo toque, sin await por medio**: el JSON es la instantánea; los ajustes
  del archivo sí se copian, porque `markBackup` los compara después de compartir. Restaurar pasa
  `importData(res.backup, { owned: true })`: la copia acaba de salir de `JSON.parse` y no se vuelve a usar, así que
  sus registros pasan a la memoria sin clonarse (también al recuperar el punto, que sale recién leído de IndexedDB).
  `exportData()` sin opciones sigue clonando (el punto de restauración y quien guarde el resultado). El archivo
  exportado es idéntico, byte a byte, al de antes; el formato no cambia.
- **Un solo montaje tras `reset`**: `navigate('#/today', { replace: true })` basta (con la URL ya en Hoy, navigate hace
  `refresh`; si no, monta su hashchange). Con navigate + refresh, WebKit montaba Hoy dos veces. Para contar montajes,
  los contenedores `.view-inner` nuevos en `#view`, no `router.onMount`: con una vista asíncrona como Hoy, los
  ganchos se llaman dos veces en cada montaje.
- **Indicador al restaurar**: mientras dura `importData`, un aviso bloqueante «Restaurando copia…» (`.cfg-busy`, fuera
  de `#app`, que queda `inert`), pintado antes del trabajo síncrono y quitado al terminar o al fallar.

Pruebas: tests/unit/backup.test.mjs (buildBackupObject comparte y da el mismo JSON; backupData con y sin `owned`),
tests/e2e/long-history.test.cjs (5 años: 30 filas, «Ver más (N)», 🏆, foco y vuelta desde una sesión; 12 meses: exportar sin clonar da el
mismo JSON, indicador, un montaje en Chromium y WebKit, datos idénticos).

## 33. Conclusiones plegables: «Lo importante esta semana» y el Resumen de Análisis

Antes, la tarjeta de Hoy con 6 meses de datos medía 990 px de párrafos, insignias y «¿Por qué?» repetidos; el Resumen
de Análisis recortaba el texto con «…». Ahora cada conclusión es una fila plegable (`views/focus-item.js`, la misma en
las dos pantallas) que se entiende en dos segundos y se abre si se quiere profundizar. **No decide nada**: pinta el
`FocusItem` de `weekFocus` (js/focus.js) con su mismo título, paso siguiente, texto, confianza y porqué; el orden y el
principal son los del motor.

- **Plegada** (lo que se ve siempre): un icono discreto del nivel (forma propia: aviso, check, flecha, info; nunca solo
  color, y su nombre para VoiceOver), el **título** como protagonista y **una línea con qué hacer** (y «· confianza
  baja» si lo es: la incertidumbre se ve sin abrir). Un aviso importante se entiende plegado: el título dice qué pasa
  y la línea qué hacer. El principal, más grande (título 18 px e icono 36 px).
- **Desplegada**: el texto en párrafos cortos (`shortParagraphs`: una frase por párrafo, las cortas con su vecina,
  sin perder un carácter), la confianza, el «¿Por qué?» y, en Análisis, «Ver detalle en Fuerza». El «Qué hacer» no se
  repite dentro, ni la confianza baja o insuficiente (ya está en la cabecera; dentro solo aparece la media o la alta).
- **Interacción** (patrón *disclosure* de WAI-ARIA): toda la cabecera es un `<button>` dentro del encabezado (≥ 44 px,
  a todo el ancho) con `aria-expanded` y `aria-controls`; el panel es una región con nombre y, plegado, `inert` (ni se
  tabula ni lo lee VoiceOver). Intro y Espacio abren y cierran. Lo abierto se recuerda mientras dura la app (volver a
  Hoy no lo cierra), nunca en los datos.
- **Animación, solo CSS**: `grid-template-rows: 0fr → 1fr` (sin medir alturas con JS ni `height: auto`), el contenido
  aparece con opacidad y 4 px de desplazamiento, el chevron gira 180°; 260 ms con la curva de iOS. Funciona igual en
  WebKit y Chromium. Mientras se anima, el contenido va recortado; al terminar, sin recorte (el anillo de foco del
  «¿Por qué?» no se corta). Con «Reducir movimiento», sin transiciones. Abrir y cerrar cuesta ~5 ms de layout y ~5 ms de
  estilos en total (≈ 0,5 ms por fotograma), medido con las métricas del motor.
- **Guardas**: `tests/e2e/focus-disclosure.test.cjs` compara el contenido con el del motor, prueba abrir y cerrar
  (toque, Intro, Espacio), ARIA e `inert`, 375/390/430 px × 100/125/150 % en Chromium y WebKit, «Reducir movimiento»
  y rendimiento. La guarda de contraste (§4) ya no mide el texto que un antepasado recorta a 0 px (el panel plegado
  no se ve); lo que asoma, sí.

## 34. Ronda 10

### 34.1 Rendimiento: Hoy→Progreso sin congelar Hoy

Antes, tocar «Progreso» montaba la pantalla entera (cabecera, «Cómo vas», accesos, objetivos, 8 gráficas, la tabla por
músculo y la lista de ejercicios) en una sola tarea, y la View Transition no empezaba hasta que acababa: Hoy se quedaba
quieto 0,2-0,3 s en un móvil rápido y 0,9-1,6 s con la CPU ×4 (móvil medio), con cualquier historial. Reglas:

- **Montaje por partes** (`views/progress.js`, `router.viewShown()`): al entrar arriba del todo, Progreso monta primero
  lo que se ve (cabecera, «Cómo vas», accesos y objetivos) y avisa al router con `viewShown()`; la transición empieza
  ya y las gráficas y después la tabla y la lista se montan en las tareas siguientes (`requestAnimationFrame` +
  `setTimeout`), con la animación en marcha. Las gráficas empiezan por debajo del pliegue en cualquier iPhone (y ≈
  1100 px), así que no se ve cómo llegan. El DOM final es el mismo. **`router.settled()` espera al montaje completo**
  (las e2e cuentan con ello). Si el router va a dejar la pantalla con scroll (scroll guardado, «atrás» `pop`,
  adelante del navegador, recarga o `refresh()` con el scroll de ahora: `navInfo().y > 0`) se monta todo de una vez,
  como antes: montada a medias la página aún es corta y el scroll se quedaría recortado (salto arriba y vuelta). Si se
  sale a mitad, lo montado se destruye y no queda nada vivo. Sin transición (`viewShown()` sin una en curso) no hace
  nada. En WebKit, `requestAnimationFrame` se pausa durante la transición: las gráficas llegan al acabar la animación
  (un respaldo con temporizador empeoraba Chromium; descartado).
- **`chartHeight()` no lee `window.innerHeight` en cada tarjeta** (`progress-ui.js`): leerlo obliga a maquetar lo
  pendiente (una maquetación forzada por gráfica). Se lee una vez y otra tras cada `resize`; la altura es la misma.
- **Objetivos de la tarjeta resumen en caché** (`views/goals.js`, `createAnalysisCache`, la misma clave que el
  analista: fecha + versión + epoch + revisión de cada almacén): Hoy→Progreso no repite `goalProgress()` (con un
  objetivo de 10 km, la serie de tiempos previstos). Solo con un `data` tomado con las revisiones actuales; cualquier
  escritura (también `syncAchieved`) recalcula. La pantalla de Objetivos no usa la caché.
- **Datos e índice compartidos** (`progress-ui.dataFromStore`, `stats.getIndex`): mientras no cambie ninguna revisión
  ni la fecha, `dataFromStore()` devuelve un objeto nuevo con **los mismos** arrays y Maps, y stats.js reutiliza el
  último índice si sus fuentes son las mismas (`isFresh`, por referencia). **Esos arrays y Maps no se modifican en
  sitio** (ya era la regla: «no mutes los objetos devueltos»): añadir campos al objeto `data` sí se puede. Quien mute
  `data` a propósito llama a `buildIndex(data)`, y ese índice nuevo pasa a ser el compartido (nunca vuelve el viejo).
- **Medido** (Chromium, iPhone 13, toque con transición `tab`, mediana de 5 aperturas tras recargar; «visible» = hasta
  que empieza la animación con Progreso): CPU ×4, 6m/1a/2a/5a: 875/924/1087/1598 → 306/321/301/307 ms; CPU ×1:
  211/238/292/362 → 101/100/134/128 ms. Tarea larga máxima ×4: 743/760/938/1471 → 396/351/374/481 ms. WebKit (Linux),
  1a/5a: 390/581 → 147/168 ms. El texto de la pantalla, la descripción de las 8 gráficas y `weeklySeries` salen
  idénticos con 6m/1a/2a/5a.
- **Guardas**: `tests/unit/chart-height.test.mjs` (8 tarjetas = 1 lectura; tras `resize`, otra) y, en
  `tests/e2e/long-history.test.cjs` con 12 meses, que al empezar la transición ya están «Cómo vas» y los accesos pero
  ninguna gráfica ni la lista, y que tras `settled()` la pantalla es igual que montada de una vez (Chromium y WebKit);
  salir a mitad sin restos ni errores; `refresh()` con scroll sin pasar por un scroll recortado (Chromium y WebKit);
  `tests/unit/stats.test.mjs` (tras forzar `buildIndex`, otro `data` con los mismos arrays usa el índice nuevo); y,
  con la cobertura de V8 por CDP, 0 llamadas a `goalProgress` y 0 reconstrucciones del índice de stats.js en
  Hoy→Progreso sin cambios (y recálculo tras una escritura).

### 34.2 Peso: un solo «tu peso» en Análisis y etiquetas que dicen qué peso es

Hay dos medidas de peso, las dos correctas y sin tocar: la **media de 7 días** con su ritmo por regresión
(`activity-logic.bwStats`: Hoy, #/bodyweight, tarjeta Peso corporal de Progreso, Objetivos) y el **peso de tendencia**
del analista (`analysis-weight.weightTrend`: media exponencial de ~10 días que salta los días de posible retención con
ciclo natural, con ritmo de Theil–Sen). El problema era usar en la misma pantalla dos pesos para la misma cosa y
nombres que no dicen cuál se muestra. Reglas:

- **La proteína de Análisis sale de un único peso: el de tendencia.** `buildAnalysis` calcula la tendencia **una vez**
  (`analysisWeightTrend`, con el mismo filtro del ciclo que `analyzeWeight`: solo mujer, con seguimiento y sin
  anticonceptivo hormonal) y la comparte: `analyzeWeight({ …, trend })` no la recalcula y `analyzeStrength(d,
  { …, bodyRefKg })` la usa en el consejo de los estancados («≈ X–Y g para tus Z kg»). Antes ese consejo usaba el
  último pesaje y convivía con «Para tu peso (79,3 kg)…» frente a «para tus 78,9 kg» y rangos de gramos distintos (y el
  informe para IA copiaba los dos). `analyzeStrength` suelto (sin `bodyRefKg`) sigue con el último pesaje. Ninguna
  fórmula cambia: solo de qué peso parte el texto.
- **«Cómo vas › Cuerpo» dice que es el peso de tendencia**: «Peso de tendencia · −0,2 kg/sem» (o «Peso de tendencia ·
  aún pocos pesajes para ver tu ritmo»). El valor y el estado no cambian; ahora no se confunde con la «Media 7 días»
  de la tarjeta Peso corporal que hay debajo.
- **«Tendencia» a secas es un ritmo (kg/sem)** en Progreso y #/bodyweight; en Análisis el KPI de peso se llama **«Peso
  de tendencia»** (kg), como ya decían las previsiones, el informe y «¿Por qué?».
- **Guardas**: `tests/unit/analysis-consistency.test.mjs` (6 y 12 meses, hombre y mujer, adulto y menor: todo «para
  tus X kg» de Análisis = `weight.proteinG.refKg` con su mismo rango de gramos y el mensaje de proteína con ese peso;
  fallaba en los 4 casos de 12 meses con 78,9 frente a 79,3/79,5 kg), `tests/unit/analysis-weight.test.mjs`
  (`analysisWeightTrend` = la tendencia de `analyzeWeight` con ciclo natural, hormonal y hombre; con `trend` dado se
  usa ese mismo objeto), `tests/unit/overview.test.mjs` (texto de la fila) y `tests/e2e/analysis.test.cjs` (etiqueta
  del KPI).
