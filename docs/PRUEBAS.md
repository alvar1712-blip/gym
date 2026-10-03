# Pruebas

| Qué | Comando | Notas |
|---|---|---|
| Unitarias (lógica pura) | `npm test` | Node, sin navegador |
| E2E en Chromium (iPhone 13 emulado) | `npm run e2e` | Incluye también las de WebKit (`tests/e2e/webkit-*.test.cjs`) si WebKit está instalado |
| E2E solo en WebKit (motor de Safari) | `npm run e2e:webkit` | Antes, una vez por máquina: `scripts/setup-webkit.sh` (navegador + bibliotecas del sistema) |
| Archivos precacheados y versión | `node scripts/check-assets.mjs` | Tras cambiar la app: `npm run stamp` |
| Velocidad de arranque | `npm run perf` | Historiales de 3 meses, 1, 2 y 5 años; CPU ×4; mediana de 5 aperturas |

## Chromium y WebKit
- La batería completa se escribió para Chromium (varias pruebas usan herramientas solo de Chrome: frenar la CPU,
  forzar el cristal con SwiftShader). Sigue siendo la referencia.
- `openApp({ browser: 'webkit' })` (o `E2E_BROWSER=webkit`) abre la app en WebKit con el mismo iPhone emulado. Las
  pruebas `webkit-*.test.cjs` se omiten, diciéndolo, si WebKit no está instalado.
- WebKit de Playwright en Linux NO es Safari de iOS: no reproduce la app instalada en la pantalla de inicio
  (standalone), el gesto de atrás del borde, el teclado real, las zonas seguras ni el almacenamiento de iOS. Esos
  puntos van en la lista de comprobación manual en iPhone (fase H de `docs/MEJORAS6.md`).

## Ronda 6: pruebas por fase
| Fase | Unitarias | E2E |
|---|---|---|
| C | `analysis-context.test.mjs` | `analysis-context.test.cjs` (Chromium 375 px, WebKit, menor de edad) |
| D | `analysis-hybrid.test.mjs` | `analysis-hybrid.test.cjs` (Chromium 375 px, WebKit, objetivo sin pesajes) |
| E | `races.test.mjs` | `races.test.cjs` (Chromium 375 px, WebKit, validación, «Borrar todo» con marcas y eventos) |
| F | `analysis-report.test.mjs` (secciones y orden, contexto, privacidad, menores, longitud) y `analysis.test.mjs` | `analysis.test.cjs` (copiar el informe) |
| G | `analysis-cache.test.mjs` (invalidación por fecha, versión, epoch y cada almacén) | `analysis-cache.test.cjs` (cada escritura real del store = calcular desde cero; Chromium y WebKit) |

Esperas: nunca pausas fijas. Tras navegar, `go()` / `settle()` (espera a `router.settled()` y a dos fotogramas); para
estados con transición CSS, `page.waitForFunction` con la condición (p. ej. la opacidad del mapa corporal, fase D).

## Medición de arranque (`npm run perf`)
- `hoy`: ms hasta ver «Te toca hoy» · `listo`: hasta completar las tarjetas del final de Hoy · `bloqTot` y `bloqMax`:
  tareas largas (> 50 ms) del arranque, total y la mayor (lo que se nota como «no responde»).
- Los valores absolutos dependen de la máquina: se comparan siempre dos versiones en la misma máquina y sesión.

Línea base de la ronda 6 (2 oct 2026, antes de la fase A):

| historial | sesiones | hoy | listo | bloqTot | bloqMax |
|---|---|---|---|---|---|
| 3 meses | 88 | 687 | 1181 | 520 | 236 |
| 1 año | 342 | 750 | 1342 | 700 | 232 |
| 2 años | 687 | 793 | 1551 | 959 | 281 |
| 5 años | 1727 | 873 | 1972 | 1337 | 547 |

## Comprobación manual en iPhone (fase A, ~5 min)
Lo que Playwright WebKit no reproduce (app instalada, teclado, ruedas de iOS, gesto de atrás, almacenamiento real).
Antes: exporta una copia (Ajustes › Copias y datos).

1. **Actualizar sin perder nada.** Abre la app con conexión → «Hay una versión nueva · Actualizar». Al volver: Hoy,
   Calendario, Progreso e historial muestran lo de siempre; Ajustes › Copias y datos tiene los mismos recuentos y una
   fila nueva «Contexto (fases y hechos)» = 0.
2. **Perfil.** Ajustes › Perfil: sexo, objetivo y experiencia siguen como estaban. Toca «Fecha de nacimiento»: sale la
   rueda de iOS; elige una fecha → aparece «N años». Marca deportes y días por semana; sal y vuelve: siguen marcados.
3. **Contexto con fechas aproximadas.** Ajustes › Tu contexto › «Añadir hecho» › «Peso habitual» › Año › 75 → Guardar.
   «Añadir fase» › «Parón o entrenamiento irregular» › Desde: Estación «Verano» · Sigue ahora: apagado · Hasta: Mes
   «Agosto» → Guardar. «Añadir fase» › «Vuelta tras vacaciones o parón» (desde septiembre) → Guardar. Comprueba: los
   desplegables usan la rueda de iOS, el teclado numérico sale en el peso y se puede llegar a «Guardar» con el teclado
   abierto.
4. **Varias fases y Hoy.** Añade otra fase vigente (p. ej. «Ganancia muscular»). Hoy muestra UNA línea «Ahora: …» con
   las dos; tócala → «Ahora» lista ambas. Desliza desde el borde izquierdo: vuelve a Hoy donde estaba, sin doble
   animación.
5. **Campos de tiempo.** Registrar › Carrera: escribe 0 h 22 min 45 s; toca los segundos de nuevo → el «45» queda
   seleccionado y al escribir «0» se sustituye. Pasa rápido de minutos a segundos con las flechas del teclado: el foco
   no salta de vuelta.
6. **Cerrar y reabrir.** Cierra la app desde el selector de apps y ábrela: el contexto y el perfil siguen ahí.
7. **Copia.** Exporta una copia nueva y comprueba que el archivo se guarda en Archivos (formato 2, con el contexto).

## Comprobación manual en iPhone (fase B, ~5 min)
Antes: exporta una copia (Ajustes › Copias y datos).

1. **Actualizar.** «Hay una versión nueva · Actualizar». Abre un día antiguo con check-in (Calendario › día): sale como
   antes, con «—» en Estrés. Ajustes › Copias y datos tiene una fila nueva «Marcas históricas» = 0.
2. **Check-in en 4 toques.** Empieza una sesión de fuerza › «¿Cómo llegas hoy?» › sueño, energía, estrés y agujetas: se
   pliega sola y la franja muestra las cuatro sin cortar letras (SUEÑO, ENERGÍA, ESTRÉS, AGUJETAS). «Registrar serie 1»
   sigue a la vista.
3. **Zona con el mapa.** Despliega el check-in › «Añadir zona» › toca los isquiotibiales en el mapa (con el dedo, sin
   zoom), «Izquierda», 7 › Añadir. Sale la ficha «Isquiotibiales izq. · 7». «Otra zona» › «Molestia o dolor» › Rodilla › 3.
   Toca la ficha de la rodilla › 5 › Guardar. Desliza hacia abajo una hoja abierta: se cierra sin guardar.
4. **Día del calendario.** Calendario › ayer › «Añadir check-in» › contesta y añade una zona desde ahí (hoja sobre
   hoja) › Listo: el día muestra el resumen «Ese día». Gesto de atrás desde el borde: vuelve al calendario sin doble
   animación.
5. **Marca histórica.** Progreso › Récords › «Marcas históricas» › + › Press banca › 100 kg × 5 › «Sé cuándo fue» ›
   Estación › Verano › año pasado › Guardar. Comprueba: teclado numérico en peso y reps, ruedas de iOS en estación y
   año, «Guardar» alcanzable con el teclado abierto. Si has hecho press banca en las últimas 4 semanas, sale
   «Rendimiento actual ≈ N %…»; abre «¿Cómo se calcula?» y revisa que los números son los tuyos.
6. **Peso corporal.** «Añadir marca» › Dominadas › «Asistencia» 20 kg × 8: el teclado es el decimal (sin «−») y el
   segmentado decide el signo. Guarda y mira la ficha de Dominadas en Progreso.
7. **Borrar y deshacer.** Abre la marca › Borrar › «Deshacer» en el aviso: vuelve a la lista sin salir de la pantalla.
8. **Cerrar y reabrir** la app desde el selector: check-ins, zonas y marcas siguen ahí. Exporta una copia nueva.

## Comprobación manual en iPhone (cierre de la ronda 6, ~10 min)
Lo que ni Chromium ni WebKit de Playwright reproducen: la app instalada en la pantalla de inicio, el teclado y las
ruedas de iOS, el gesto de atrás, las zonas seguras, el almacenamiento real y el modo sin conexión de verdad.
Antes: Ajustes › Copias y datos › «Exportar copia» (guárdala en Archivos).

1. **Actualizar (1 min).** Abre la app con conexión → «Hay una versión nueva · Actualizar». Hoy, Calendario, Progreso e
   historial muestran lo de siempre; Ajustes › Copias y datos tiene los mismos recuentos y la fila «Eventos deportivos».
2. **Hoy (1 min).** «Te toca hoy» y «Empezar» a la vista sin desplazar; como mucho una línea «Ahora: …» y una
   «🏁 …» (si tienes un evento A o B). Abajo, «Tu análisis» con la confianza junto a cada punto.
3. **Sesión de fuerza (2 min).** Empezar › check-in en 4 toques › registra 2 series escribiendo peso y reps (teclado
   numérico, la coma decimal funciona) › cierra la app desde el selector de apps a mitad › ábrela: la sesión sigue igual ›
   Terminar.
4. **Contexto y marcas (1 min).** Ajustes › Tu contexto › añade «Empiezo creatina» (rueda de iOS en la fecha). Progreso ›
   Récords › Marcas históricas: abre una y vuelve con el gesto del borde (sin doble animación).
5. **Evento (1 min).** Objetivos › «Eventos deportivos» › + › 10K, fecha (rueda de iOS), 50 min en «Tiempo objetivo» ›
   Guardar. Hoy muestra «🏁 10K · N días · objetivo <50:00»; tócala y vuelve.
6. **Análisis e informe (2 min).** Progreso › Análisis: «Tu contexto» arriba (creatina, evento), tarjetas con «Confianza
   …», «Carga por deporte» en Resistencia. Abre un «¿Por qué?». «Copiar informe para tu IA» › pégalo en Notas: empieza
   por PERFIL, OBJETIVO, CONTEXTO DEL USUARIO, CAMBIOS RECIENTES y termina con DATOS CON BAJA CONFIANZA y PREGUNTA.
   Vuelve a Hoy y otra vez a Análisis: debe abrir al instante (caché).
7. **Sin conexión (1 min).** Modo avión › cierra y abre la app desde la pantalla de inicio: Hoy, Calendario, Progreso y
   Análisis se abren; registra un pesaje. Quita el modo avión.
8. **Copia (1 min).** Exporta una copia nueva y comprueba que se guarda en Archivos. Si algo fue mal en los pasos
   anteriores, importa la copia del principio (Ajustes › Copias y datos › Importar).
