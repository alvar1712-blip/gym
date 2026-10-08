# Informe · Ronda de pulido premium

Una ronda de calidad, sin funciones nuevas. Las reglas que deja están en [PULIDO.md](PULIDO.md); aquí, qué se hizo,
qué cambia para ti y cómo comprobarlo en el iPhone. Nada de esto toca el esquema de datos (IndexedDB v3), las
migraciones, la copia de seguridad ni la importación FIT/GPX/TCX.

## Resultado de las pruebas

- Unitarias: **602/602**.
- E2E Chromium: **216/217** en la última batería completa (el fallo era el del texto al 150 % en WebKit, arreglado
  después); WebKit: **205/206** (+11 solo de Chromium); el fallo era una prueba nueva mal planteada, arreglada (ver
  el punto 15). Las suites afectadas por los últimos cambios, otra vez en verde en los dos motores.
- Guardas visuales (todas las pantallas, datos realistas de 6 meses y app vacía): 375, 390 y 430 px; texto al
  100, 125 y 150 %; Chromium y WebKit. Capturas en `test-results/visual/`.

## Los 25 puntos

| # | Punto | Estado | Qué se hizo |
|---|---|---|---|
| 0 | Auditoría | Hecho | Recorrido de todas las pantallas con datos realistas y vacías; de ahí salen las guardas visuales (§4). |
| 1 | Sistema visual (tokens) | Hecho | Escala tipográfica de 6 pasos, nada por debajo de 12 px, sin medios píxeles (§1). |
| 2 | Fatiga de tarjetas | Hecho | Hoy: dos tarjetas de lectura → una («Lo importante esta semana»). Resumen de sesión: 6 casillas iguales → 3 cifras + 1 línea. |
| 3 | Progreso por áreas | Hecho | «Cómo vas»: Fuerza, Resistencia, Cuerpo y Recuperación, con cifra, cambio de 4 semanas y minigráfica (§7). |
| 4 | «Lo importante esta semana» | Hecho | Como mucho 3, uno por tema, un solo «Qué hacer» (§6). |
| 5 | Analista (1 principal + 2) | Hecho | Misma regla en #/analysis; sin avisos: «Todo evoluciona dentro de lo esperado. No necesitas cambiar nada.» |
| 6 | Estados unificados | Hecho | Un componente con icono y texto (nunca solo color); «Info» del mismo color en todas partes (§5). |
| 7 | Minigráficas | Hecho | `charts.sparkline`, ligera y sin ejes, en «Cómo vas». |
| 8 | Gráficas: la frase | Hecho | Cada gráfica principal dice qué pasó: «+7,5 kg desde agosto», «Media 24 km/sem · +12 %» (§12). Tooltip y periodo recordado ya existían. |
| 9 | Resumen de sesión | Hecho | 3 cifras protagonistas y «Frente a la anterior» con datos reales (§10). |
| 10 | Sesión en curso | Hecho | «Última vez» legible y el siguiente paso («↑ Sube a 82,5 kg») en la línea del objetivo, sin restar espacio (§10). |
| 11 | Datos imposibles / raros | Hecho | Imposibles no se guardan; muy raros piden «¿Seguro?» (§14). |
| 12 | Formatters | Hecho | 5 errores en los bordes arreglados con pruebas (§15). |
| 13 | «Deshacer» | Hecho | 16 problemas confirmados y arreglados; nuevas acciones con «Deshacer» (§16). |
| 14 | Navegación robusta | Hecho | Dos carreras del router arregladas (§11 y §16): ninguna navegación acaba en otra pantalla. |
| 15 | Áreas seguras 375/390/430 | Hecho | Ya estaban (viewport-fit + env()); ahora las guardas lo vigilan en los tres anchos. |
| 16 | Accesibilidad: 44 px | Hecho | Todo control ≥ 44 px (antes 38–40 px en algunos), vigilado. |
| 17 | Accesibilidad: VoiceOver | Hecho | 31 problemas confirmados en auditoría y arreglados: foco, avisos, nombres (§17). |
| 18 | Contraste y tema oscuro | Hecho | Rosa de la regla, «Descanso», placeholders y días de otro mes ≥ 4,5:1; «Aumentar contraste». |
| 19 | Movimiento y transparencia | Hecho | Todo desplazamiento por código respeta «Reducir movimiento»; barras opacas con «Reducir transparencia». |
| 20 | Texto 100/125/150 % | Hecho | La app sigue el tamaño de texto de iOS (antes lo ignoraba); nada se corta ni se sale (§17). |
| 21 | Hoy adaptativo | Hecho | El orden cambia según el momento: sesión abierta, antes de entrenar, hecho o descanso, evento cercano (§8). |
| 22 | Estados vacíos | Revisado | La guarda recorre la app vacía en Chromium y WebKit sin problemas; «Cómo vas» dice qué falta en cada fila. Sin cambios de diseño. |
| 23 | Términos y microcopy | Hecho | Glosario (§9); textos del check-in, objetivos, avisos de datos y «Km por semana». |
| 24 | Rendimiento | Hecho | Medido antes/después (tabla abajo). La ronda había empeorado la tarea más larga de Hoy y se corrigió. |

Espaciado e iconos: no se rediseñaron. Se revisaron dentro de las guardas (nada tapado, nada desbordado) y los
iconos de estado pasan a ir siempre con texto.

## Antes → después

1. **Hoy mostraba el texto «null»** en la tarjeta del ciclo y en las zonas del check-in → ya no.
2. **«Ritmo de 6:12:00 /km»** en un aviso → «Más de una hora por km: más lento que caminar. ¿Escribiste los minutos en la casilla de las horas?»
3. **900 kg en press banca se registraba sin más** → «¿Seguro? Has puesto 900 kg. ¿Es correcto?» con «Corregir» / «Sí, registrar».
4. **10 km en 2 minutos se guardaba** → no se guarda: «Sin guardar: revisa los datos» y «Listo» no deja salir.
5. **Dos tarjetas de lectura en Hoy** (resumen semanal + «Tu análisis») → una, con 3 mensajes como mucho y un «Qué hacer» por mensaje.
6. **Resumen de sesión con 6 casillas iguales** → duración, series y récords grandes; y «Frente a la anterior: Press banca +2,5 kg».
7. **En la sesión no sabías qué tocaba** → «Objetivo 3×4–6 · ↑ Sube a 82,5 kg» o «◎ 6/6/6 → +2,5 kg».
8. **Borrar un evento desde Hoy y «Deshacer»: no volvía a verse** hasta salir y entrar → vuelve al instante.
9. **Borrar algo y tocar otra pestaña enseguida te devolvía a la ficha borrada** (con el disco lento) → te quedas donde fuiste.
10. **Un toque sin querer en otra alternativa perdía las series pendientes** → «Cambiado a … · Deshacer».
11. **El tamaño de texto del iPhone no hacía nada** → la app crece hasta el 150 % sin cortar ni desbordar nada.
12. **VoiceOver se quedaba detrás de las hojas** y volvía arriba al registrar una serie → entra en la hoja y sigue en la tarjeta.

## Rendimiento (arranque de Hoy, CPU ×4, mediana de 5 aperturas, media de 2 rondas intercaladas)

| Historial | Sesiones | «Te toca hoy» visible | Hoy completo | Tarea más larga |
|---|---|---|---|---|
| 3 meses | 87 | 342 → 336 ms | 608 → 584 ms | 121 → 110 ms |
| 1 año | 337 | 394 → 382 ms | 766 → 761 ms | 129 → 123 ms |
| 2 años | 683 | 420 → 420 ms | 866 → 908 ms | 172 → 166 ms |
| 5 años | 1720 | 548 → 553 ms | 1269 → 1276 ms | 307 → 312 ms |

Antes = commit abe78a8 (inicio de la ronda); después = final. Diferencias dentro del ruido entre rondas (±50 ms).
La primera medición mostró que la tarea más larga había crecido (5 años: 307 → 497 ms) por juntar dos cálculos en
una tarjeta; se separaron en dos tareas y volvió a su nivel.

## Comprobación en el iPhone (10 minutos)

1. **Actualiza**: abre la app, acepta «Hay una versión nueva» si sale y vuelve a abrirla.
2. **Hoy** (1 min): sin «null» en ninguna tarjeta; «Lo importante esta semana» con 3 mensajes como mucho y un «Qué hacer» cada uno.
3. **Sesión** (2 min): empieza una; mira «Última vez» y la flecha del objetivo. Escribe 900 kg y pulsa Registrar → «¿Seguro?» → «Corregir». Toca otra alternativa y pulsa «Deshacer».
4. **Resumen** (1 min): termina la sesión; tres cifras arriba y «Frente a la anterior» si repetiste la rutina.
5. **Actividad** (1 min): una carrera de 10 km en 2 min → «Sin guardar: revisa los datos»; cámbialo a 50 min → «Guardado».
6. **Deshacer** (1 min): borra un evento entrando desde Hoy → «Deshacer» → vuelve a verse en Hoy sin salir.
7. **Progreso** (1 min): «Cómo vas» con cuatro filas y su minigráfica; abre una gráfica y lee la frase de arriba.
8. **Texto grande** (1 min): Ajustes › Pantalla y brillo › Tamaño del texto al máximo (sin «Tamaños más grandes»); vuelve a la app: todo más grande, nada cortado con «…» ni montado.
9. **VoiceOver** (1 min): actívalo, abre «Borrar» en cualquier ficha: debe leer el título de la hoja; ciérrala y vuelve a donde estabas.
10. **Reducir movimiento** (30 s): actívalo y registra una serie: el salto a la siguiente tarjeta es inmediato, sin animación.

Si algo no cuadra, una captura de pantalla con la hora basta para localizarlo.
