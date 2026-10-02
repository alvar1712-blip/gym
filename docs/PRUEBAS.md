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
