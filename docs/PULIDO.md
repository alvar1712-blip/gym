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
