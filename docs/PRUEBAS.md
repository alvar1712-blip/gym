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
